var connect = require('connect'), express = require('express'), sys = require('sys'), io = require('socket.io'), RedisStore = require('connect-redis'), redis_client = require(
    "redis").createClient(), port = (process.env.PORT || 80);

var stat = __dirname + '/static';
var sessionStore = new RedisStore();
// Setup Express
var server = express.createServer();
server.configure(function() {
  server.set('views', __dirname + '/views');
  server.set('view engine', 'jade');
  server.use(express.compiler({ src : stat, enable : [ 'sass' ] }));
  server.use(express.bodyParser());
  server.use(express.cookieParser());
  server.use(express.session({ key : 'sessionKey', secret : 'api secret', store : sessionStore }));
  server.use(express.static(stat));
  server.use(server.router);
  server.use('/', express.errorHandler({ dump : true, stack : true }));
});

/*******************************************************************************
 * Server Variables
 */

vote1 = 0;
vote2 = 0;
flag1 = 0;
flag2 = 0;

sortedSet = "zSet";
leaderSet = "zLeaders";
tmpSet = "zTemp";
counter = "counter";
appDb = "hApp";
leaders = [];
loserClient = '';
emailList = "emailList";

/*******************************************************************************
 * start clean up the db on a new start FIXME: use config params to wrap this
 * instead (development vs production)
 */
console.log("Cleaning up the db!");
redis_client.del(sortedSet);// removes the queue!!
redis_client.hset(appDb, counter, 0);
// end clean DB

// Setup Socket.IO
var io = io.listen(server);
io.on('connection', function(client) {

  sendLeaders(client, false);

  /** * CLIENT CONNECT *** */
  redis_client.HINCRBY(appDb, counter, 1, function(err, counter) {
    sendStats(counter);
  });

  /** * CLIENT DISCONNECT *** */
  client.on('disconnect', function() {

    removeFromQueue(client.sessionId);
    redis_client.HINCRBY(appDb, counter, -1, function(err, counter) {
      sendStats(counter);
    });
  });

  /** * CLIENT MESSAGE *** */
  client.on('message', function(message) {
    if (message.queue) {
      addToQueue(client.sessionId);
    }
    else if (message.vote) {
      vote(message.vote);
    }
    else if (message.flag) {
      flag(message.flag);
    }
    else if (message.entry) {
      addEntry(client.sessionId, message.entry);
    }
    else if (message.streaming) {
      confirmedStreaming(client.sessionId, message.streaming);
    }
    else if (message.abortStream) {
      removeFromQueue(client.sessionId);
      abortStreaming(client.sessionId, message.abortStream);
    }

    if (message.vote || message.flag) {
      determineLoser();
    }
    sendStatsGetCounter();
  });

  manageQueue();
});

/*******************************************************************************
 * Sends statistics to all clients (broadcasts!)
 * 
 * @param client
 *          the socket.io client object
 */
function sendStats(counter) {
  io.broadcast({ gamestats : getStats(counter) });
}

function sendStatsGetCounter() {
  redis_client.hget(appDb, counter, function(err, counter) {

    io.broadcast({ gamestats : getStats(counter) });
  });
}
function getStats(counter) {
  return "" + counter + "|" + vote1 + "|" + vote2 + "|" + flag1 + "|" + flag2 + "";
}
/*******************************************************************************
 * Sends the leaderboard to a client
 * 
 * @param client
 *          the socket.io client object
 * @return
 */
function sendLeaders(client, doBroadcast) {
  if (leaders.length == 0) {
    redis_client.zrevrange(leaderSet, 0, 9, "WITHSCORES", function(err, results) {
      leaders[0] = { id : results[0], ts : results[1] };
      leaders[1] = { id : results[2], ts : results[3] };
      leaders[2] = { id : results[4], ts : results[5] };
      leaders[3] = { id : results[6], ts : results[7] };
      leaders[4] = { id : results[8], ts : results[9] };
      if (doBroadcast) {
        io.broadcast({ leaders : leaders });
      }
      else {
        client.send({ leaders : leaders });
      }

    });
  }
  else {
    if (doBroadcast) {
      io.broadcast({ leaders : leaders });
    }
    else {
      client.send({ leaders : leaders });
    }
  }
}

/*******************************************************************************
 * Adds entry to leaderboard!
 */
function addEntry(clientId, entry) {
  redis_client.ZSCORE(tmpSet, clientId, function(error, broadcastTime) {
    if (broadcastTime) {
      redis_client.ZREM(tmpSet, clientId);// remove from tmpSet
      redis_client.zadd(leaderSet, broadcastTime, clientId + "|" + entry.name + "|" + entry.image + "|" + entry.url, function(error, reply) {
        console.log("adding a new item to the leaderboard! " + clientId);
        thresholdTime = 0;
        leaders.length = 0;
        sendLeaders(null, true);
      });
    }
  });

}
/*******************************************************************************
 * Adds a client to the queue
 * 
 * @param clientId
 *          the socket.io id of the client
 */
function addToQueue(clientId) {
  var ts = Math.round(new Date().getTime() / 1000.0);
  redis_client.zadd(sortedSet, ts, clientId, function(err, response) {
    console.log(clientId + " added to queue with epoch: " + ts);
    if (io.clients[clientId])
      io.clients[clientId].send({ announcement : "inQueue" });
    redis_client.HMGET(appDb, "stream1Client", "stream2Client", function(err, results) {
      if (results[0] == '' || !io.clients[results[0].split("|")[0]]) {
        addNext(1);
      }
      else if (results[1] == '' || !io.clients[results[1].split("|")[0]]) {
        addNext(2);
      }

    });
  });
}

/*******************************************************************************
 * Handles voting on a given stream number by increasing the vote1 or vote2 var
 * 
 * @param streamNum
 *          the number of the stream being voted up
 */
function vote(streamNum) {
  if (streamNum == '1') {
    vote1++;
  }
  else if (streamNum == '2') {
    vote2++;
  }
  // logAnalytics('vote received for: ' + streamNum);
}

/*******************************************************************************
 * Handles flagging on a given stream number by increasing the flag1 or flag2
 * var
 * 
 * @param streamNum
 *          the number of the stream being flagged
 */
function flag(streamNum) {
  if (streamNum == '1') {
    flag1++;
  }
  else if (streamNum == '2') {
    flag2++;
  }
  // logAnalytics("flag received for: " + streamNum);
}

/*******************************************************************************
 * Determines the loser based on the following rules: If the votes are over 50%
 * of the total viewership OR If the flags are over 10% of the total viewership
 */
function determineLoser() {
  redis_client.hget(appDb, counter, function(err, counter) {
    if (vote1 > (counter / 2)) {
      removeLoser(2);
      addNext(2);
    }
    else if (vote2 > (counter / 2)) {
      removeLoser(1);
      addNext(1);
    }

    if (flag1 > (counter / 10)) {
      removeLoser(1);
      addNext(1);
    }
    else if (flag2 > (counter / 10)) {
      removeLoser(2);
      addNext(2);
    }

  });
  // logAnalytics("determineLoser");
}

/*******************************************************************************
 * Broadcasts to everyone the winning stream
 */

function broadcastWinner(streamNum) {
  io.broadcast({ winner : streamNum });
}
/*******************************************************************************
 * Finds the next person in the queue and adds them to the stream that is now
 * empty
 * 
 * @param streamNum
 *          the number (1 or 2) of the stream that is now empty
 */
function addNext(streamNum) {
  var streamId;
  switch (streamNum)
  {
    case 1:
      streamId = "stream1";
      break;
    case 2:
      streamId = "stream2";
      break;
  }

  redis_client.zrange(sortedSet, 0, 1, "WITHSCORES", function(err, results) {
    if (results[0] != undefined) {
      removeFromQueue(results[0]);
      startStream(results[0], streamId);
    }
  });
  // logAnalytics("addNext with: " + streamNum);
}

/*******************************************************************************
 * Calculates the wait time and sends it to the clientId
 * 
 * @deprecated
 */
function sendWaitTime(clientId) {
  redis_client.zcard(sortedSet, function(error, qlength) {
    redis_client.zrank(sortedSet, clientId, function(error, rank) {
      if (io.clients[clientId] != undefined) {
        io.clients[clientId].send({ queue : { position : rank, qlength : qlength } });
      }
    });
  });
}
/*******************************************************************************
 * Removes the losing client from the given streamId, updates the database
 * 
 * @param streamId -
 *          the id of the stream (left or right)
 */
function removeLoser(streamId) {

  switch (streamId)
  {
    case 1:
      redis_client.HGET(appDb, "stream1Client", function(err, results) {
        var loser = String(results).split("|");
        stopStream(loser[0]);
        redis_client.HSET(appDb, "stream1Client", "", function(err, setResult) {
          determineLeaderboard(loser[0], loser[1], 1);
        });
      });
      broadcastWinner(2);
      break;
    case 2:
      redis_client.HGET(appDb, "stream2Client", function(err, results) {
        var loser = String(results).split("|");
        stopStream(loser[0]);
        redis_client.HSET(appDb, "stream2Client", "", function(err, setResult) {
          determineLeaderboard(loser[0], loser[1], 2);
        });
      });
      broadcastWinner(1);
      break;
  }
  vote1 = 0;
  vote2 = 0;
  flag1 = 0;
  flag2 = 0;
  manageQueue();
  // logAnalytics("removing loser from: " + streamId);
}

function getNow() {
  return Math.round(new Date().getTime() / 1000.0);
}
/*******************************************************************************
 * Determines if a client's broadcast time beats the threshold time and adds
 * them to the leaderboard
 * 
 * @param clientId -
 *          socket.io sessionId of the client
 * @param ts
 *          TimeStamp in milliseconds -eg. Math.round(new Date().getTime() /
 *          1000.0);
 */

function determineLeaderboard(clientId, ts, streamNum) {
  if (clientId != undefined && ts != undefined) {

    // before we remove, lets check how long they broadcast for
    var broadcastTime = getNow() - ts;

    var lastLeaderTime = 0;
    if (leaders[4] != undefined && leaders[4].ts != undefined) {
      lastLeaderTime = leaders[4].ts;
    }

    if (broadcastTime > lastLeaderTime) {
      redis_client.zadd(tmpSet, broadcastTime, clientId);
      // prompt for them to be on the Leaderboard
      if (io.clients[clientId] != undefined) {
        io.clients[clientId].send({ announcement : 'leaderboard' });
        sendLeaders(io.clients[clientId], true);
      }
    }
  }
}

/*******************************************************************************
 * Sends a stopStream message to a client (usually the LOSER!) lulz
 * 
 * @param clientId
 */
function stopStream(clientId) {
  if (io.clients[clientId] != undefined)
    io.clients[clientId].send({ message : 'stopStream' });
  // logAnalytics("Stopstream sent to: " + clientId);
}

/*******************************************************************************
 * Sends the startStream message to a client (next person in queue!)
 * 
 * @param clientId -
 *          socket.io sessionId of the client
 * @param ts -
 *          Timestamp of when they connected to the queue for later use in
 *          comparing broadcast times with threshold
 * @param streamId -
 *          the stream they should publish on
 * @return
 */
function startStream(clientId, streamId) {

  if (io.clients[clientId] != undefined)
    io.clients[clientId].send({ message : streamId });
}

function confirmedStreaming(clientId, streamId) {
  var now = getNow();
  if (streamId == "stream1")
    redis_client.hset(appDb, "stream1Client", clientId + "|" + now);
  else if (streamId == "stream2")
    redis_client.hset(appDb, "stream2Client", clientId + "|" + now);
  io.broadcast({ message : "newbattle" });
  console.log(clientId + " should be publishing to: " + streamId);
}

function abortStreaming(clientId, streamId) {
  redis_client.HMGET(appDb, "stream1Client", "stream2Client", function(err, results) {
    if (clientId == results[0]) {
      removeLoser(1);
      addNext(1);
    }
    else if (clientId == results[1]) {
      removeLoser(2);
      addNext(2);
    }
  });
}
/*******************************************************************************
 * Removes a client from the Queue (the database's sortedSet)
 * 
 * @param clientId -
 *          socket.io sessionId of the client
 */
function removeFromQueue(clientId) {
  if (clientId != undefined) {
    redis_client.zrem(sortedSet, clientId, function(err, response) {
      console.log(clientId + " removed from queue");
    });
    // now check if they were broadcasting!
    // redis_client.HMGET(appDb, "stream1Client", "stream2Client", function(err,
    // results) {
    // if (clientId == results[0])
    // removeLoser(1);
    // else if (clientId == results[1])
    // removeLoser(2);
    // });
  }
}

/*******************************************************************************
 * Cleans up the Queue by looping over the next ten people and kicking them off
 * the queue if they're not connected anymore
 */
function manageQueue() {
  redis_client.zrange(sortedSet, 0, 10, function(err, replies) {
    replies.forEach(function(reply) {
      if (io.clients[reply] == undefined) {
        removeFromQueue(reply);
      }
      else {
        io.clients[reply].send({ announcement : "warnLive" });
      }
    });
  });
}

/*******************************************************************************
 * Should tell us the votes, flags, etc
 * 
 * @param method
 *          Should be the method calling logAnalytics
 * @return
 */
function logAnalytics(method) {
  console.log("+++++++++++++\n" + method);
  console.log('Votes for Stream 1: ' + vote1);
  console.log('Votes for Stream 2: ' + vote2);
  console.log('Flags for Stream 1: ' + flag1);
  console.log('Flags for Stream 2: ' + flag2);
  // redis_client.zrange(sortedSet, 0, -1, function(err, replies) {
  // console.log(replies.length + " in queue:");
  // replies.forEach(function(reply, i) {
  // console.log(" " + i + ": " + reply);
  // console.log("+++++++++++++\n");
  // });
  // });

}

function getLang(req){
  try {
    if (req.query.lang)
      return req.query.lang;
    return req.headers['accept-language'].split(',')[0].split(';', 1)[0];
  }
  catch(err){
    console.log("error in detecting language, defaulting to en!");
  }
  return "en";
  
}
// Start the server
server.listen(port);
var bg = [ "graffiti", "boxing", "nebula", "city" ];

/*******************************************************************************
 * Routes served by the web server
 */
server.get('/preview', function(req, res) {
  req.session.cookie.expires = false;
  // var theme = bg[Math.floor(Math.random()*bg.length)]
  var theme = "boxing";
  res.render('index.jade', { locals : { header : 'Live Showdown', footer : '&copy;Live Showdown', title : 'Live Showdown', sessionKey : req.sessionID, theme : theme, lang : getLang(req) } });
});
server.get('/', function(req, res) {
  res.render('offline.jade', {layout: false, locals : { title : 'Live Showdown', lang : getLang(req)}});
});
server.get('/addEmail', function(req, res) {
  if (req.query.email)
  {
    redis_client.RPUSH(emailList, req.query.email, function(err,result){
      res.send("ok");
      console.log('received: '+req.query.email);
    });
  }
});
console.log('Listening on http://0.0.0.0:' + port);
