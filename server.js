var connect = require('connect'), express = require('express'), sys = require('sys'), io = require('socket.io'), RedisStore = require('connect-redis'), redis_client = require(
    "redis").createClient(), port = (process.env.PORT || 8081);

var stat = __dirname + '/static';
var sessionStore = new RedisStore();
// Setup Express
var server = express.createServer();
server.configure(function() {
  server.set('views', __dirname + '/views');
  server.set('view engine', 'jade');
  server.use(express.compiler( { src : stat, enable : [ 'sass' ] }));
  server.use(express.bodyParser());
  server.use(express.cookieParser());
  server.use(express.session( { key : 'sessionKey', secret : 'api secret', store : sessionStore }));
  server.use(express.static(stat));
  server.use(server.router);
  server.use('/', express.errorHandler( { dump : true, stack : true }));
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
counter = "counter";
appDb = "hApp";
leaders = [];
emptyStream1 = true;
emptyStream2 = true;
loserClient = '';

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
  redis_client.HINCRBY(appDb, counter, 1, function(err, result) {
    sendStats(result, client);
  });

  /** * CLIENT DISCONNECT *** */
  client.on('disconnect', function() {

    removeFromQueue(client.sessionId);
    redis_client.HINCRBY(appDb, counter, -1, function(err, result) {
      sendStats(result, client);
    });
    cleanUpQueue();
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

    if (message.vote || message.flag) {
      determineLoser();
    }
  });
});

/*******************************************************************************
 * Sends statistics to all clients (broadcasts!)
 * 
 * @param client
 *          the socket.io client object
 */
function sendStats(counter, client) {
  client.broadcast( { stats : { viewers : counter, vote1 : vote1, vote2 : vote2, flag1 : flag1, flag2 : flag2 } });
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
        client.broadcast( { leaders : leaders });
      }
      else {
        client.send( { leaders : leaders });
      }

    });
  }
  else {
    if (doBroadcast) {
      client.broadcast( { leaders : leaders });
    }
    else {
      client.send( { leaders : leaders });
    }
  }
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

    if (emptyStream1) {// handle empty queues (usually on startup)
        addNext(1);
        emptyStream1 = false;
      }
      else if (emptyStream2) {
        addNext(2);
        emptyStream2 = false;
      }
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
      startStream(results[0], results[1], streamId);
    }
  });
  // logAnalytics("addNext with: " + streamNum);
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
          determineLeaderboard(loser[0], loser[1]);
        });
      });
      break;
    case 2:
      redis_client.HGET(appDb, "stream2Client", function(err, results) {
        var loser = String(results).split("|");
        stopStream(loser[0]);
        redis_client.HSET(appDb, "stream2Client", "", function(err, setResult) {
          determineLeaderboard(loser[0], loser[1]);
        });
      });
      break;
  }
  vote1 = 0;
  vote2 = 0;
  flag1 = 0;
  flag2 = 0;
  // logAnalytics("removing loser from: " + streamId);
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
function determineLeaderboard(clientId, ts) {
  if (clientId != undefined && ts != undefined) {
    var now = Math.round(new Date().getTime() / 1000.0);
    // before we remove, lets check how long they broadcast for
    var broadcastTime = now - ts;

    var lastLeaderTime = 0;
    if (leaders[4] != undefined && leaders[4].ts != undefined) {
      lastLeaderTime = leaders[4].ts;
    }

    if (broadcastTime > lastLeaderTime) {
      console.log("adding a new item to the leaderboard! " + clientId);
      redis_client.zadd(leaderSet, broadcastTime, clientId);
      thresholdTime = 0;
      leaders.length = 0;

      if (io.clients[clientId] != undefined) {
        io.clients[clientId].send( { message : 'leaderboard' });
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
    io.clients[clientId].send( { message : 'stopStream' });
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
function startStream(clientId, ts, streamId) {
  if (io.clients[clientId] != undefined)
    io.clients[clientId].send( { message : streamId });

  if (streamId == "stream1")
    redis_client.hset(appDb, "stream1Client", clientId + "|" + ts);
  else if (streamId == "stream2")
    redis_client.hset(appDb, "stream2Client", clientId + "|" + ts);

  console.log(clientId + " should be publishing to: " + streamId);

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
  }
}

/*******************************************************************************
 * Cleans up the Queue by looping over the next ten people and kicking them off
 * the queue if they're not connected anymore
 */
function cleanUpQueue() {
  redis_client.zrange(sortedSet, 0, 10, function(err, replies) {
    replies.forEach(function(reply) {
      if (io.clients[reply] == undefined) {
        removeFromQueue(reply);
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

// Start the server
server.listen(port);

/*******************************************************************************
 * Routes served by the web server
 */
server.get('/', function(req, res) {
  req.session.cookie.expires = false;
  res.render('index.jade', { locals : { header : 'SharkVideo', footer : '&copy;SharkMob', title : 'SharkVideo', sessionKey : req.sessionID } });
});

console.log('Listening on http://0.0.0.0:' + port);
