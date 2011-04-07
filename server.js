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
  server.use('/', express.errorHandler({ dump: true, stack: true }));
});

// ****************
// Server Variables
// ****************
vote1 = 0;
vote2 = 0;
flag1 = 0;
flag2 = 0;

thresholdTime = 0;
sortedSet = "zSet";
leaderSet = "zLeaders";
counter = "counter";
appDb = "hApp";
leaders = [];
emptyStream1 = true;
emptyStream2 = true;
loserClient = '';

// start clean up the db on a new start
// case server fails
console.log("Cleaning up the db!");
redis_client.del(sortedSet);// removes the queue!!
redis_client.hset(appDb, counter, 0);
// end clean DB

// get the time for the nth record (leader threshold)
if (thresholdTime == 0) {
  redis_client.zrevrange(leaderSet, 9, 9, "WITHSCORES", function(err, results) {
    if (results[0] != undefined) {
      thresholdTime = results[1];// score for the lowest item!
    }
  });
}

// Setup Socket.IO
var io = io.listen(server);
io.on('connection', function(client) {

  /** * CLIENT CONNECT *** */
  redis_client.HINCRBY(appDb, counter, 1);
  if (leaders.length == 0) {
    redis_client.zrevrange(leaderSet, 0, 9, "WITHSCORES", function(err, results) {
      leaders[0] = { id : results[0], ts : results[1] };
      leaders[1] = { id : results[2], ts : results[3] };
      leaders[2] = { id : results[4], ts : results[5] };
      leaders[3] = { id : results[6], ts : results[7] };
      leaders[4] = { id : results[8], ts : results[9] };
      client.send( { leaders : leaders });
    });
  }
  else {
    client.send( { leaders : leaders });
  }

  /** * CLIENT DISCONNECT *** */
  client.on('disconnect', function() {
    // todo remove connection_id from hashmaan
      removeFromQueue(client.sessionId);
      redis_client.HINCRBY(appDb, counter, -1);
    });

  /** * CLIENT MESSAGE *** */
  client.on('message', function(message) {
    if (message.sessionKey) {
      // TODO: do something with the session key!
      // sessionStore.get(message.sessionKey, function(err, session) {
      // console.log(session);
      // });
    }
    else if (message.queue) {
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
  // cleanUpQueue();
  });

function addToQueue(clientId) {
  var ts = Math.round(new Date().getTime() / 1000.0);
  redis_client.zadd(sortedSet, ts, clientId, function(err, response) {
    console.log(clientId + " added to queue with epoch: " + ts);
    // handle empty queues (usually on startup)
      if (emptyStream1) {
        addNext(1);
        emptyStream1 = false;
      }
      else if (emptyStream2) {
        addNext(2);
        emptyStream2 = false;
      }
    });
}

function vote(streamNum) {
  if (streamNum == '1') {
    vote1++;
  }
  else if (streamNum == '2') {
    vote2++;
  }
  logAnalytics('vote received for: ' + streamNum);
}

function flag(streamNum) {
  if (streamNum == '1') {
    flag1++;
  }
  else if (streamNum == '2') {
    flag2++;
  }
  //logAnalytics("flag received for: " + streamNum);
}

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
  //io.clients.broadcast({counter: counter, vote1: vote1, vote2: vote2, flag1: flag1, flag2 : flag2});
  //logAnalytics("determineLoser");
}

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
  //logAnalytics("addNext with: " + streamNum);
}
function removeLoser(streamId) {

  switch (streamId)
  {
    case 1:
      redis_client.HMGET(appDb, "stream1Client", function(err, results) {
        var loser = String(results).split("|");
        stopStream(loser[0]);
        redis_client.HSET(appDb, "stream1Client", "", function(err, setResult) {
          determineLeaderboard(loser[0], loser[1]);
        });
      });
      break;
    case 2:
      redis_client.HMGET(appDb, "stream2Client", function(err, results) {
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
  //logAnalytics("removing loser from: " + streamId);
}

function determineLeaderboard(clientId, ts) {
  if (clientId != undefined && ts != undefined) {
    var now = Math.round(new Date().getTime() / 1000.0);
    // before we remove, lets check how long they broadcast for
    var broadcastTime = now - ts;
    if (broadcastTime > thresholdTime) {// found a winner!
      console.log("adding a new item to the leaderboard! " + clientId);
      redis_client.zadd(leaderSet, broadcastTime, clientId);
      thresholdTime = 0;
      leaders.length = 0;
      if (io.clients[clientId] != undefined) {
        io.clients[clientId].send( { message : 'leaderboard' });
      }
    }
    //logAnalytics("determineLeaderboard with client: " + clientId + " ts: " + ts);
  }
}
function stopStream(clientId) {
  if (io.clients[clientId] != undefined)
    io.clients[clientId].send( { message : 'stopStream' });
  //logAnalytics("Stopstream sent to: " + clientId);
}
function startStream(clientId, ts, streamId) {
  if (io.clients[clientId] != undefined)
    io.clients[clientId].send( { message : streamId });

  if (streamId == "stream1")
    redis_client.hset(appDb, "stream1Client", clientId + "|" + ts);
  else if (streamId == "stream2")
    redis_client.hset(appDb, "stream2Client", clientId + "|" + ts);

  console.log(clientId + " should be publishing to: " + streamId);

}

function removeFromQueue(clientId) {
  if (clientId != undefined) {
    redis_client.zrem(sortedSet, clientId, function(err, response) {
      console.log(clientId + " removed from queue");
    });
  }
}

function cleanUpQueue() {

  redis_client.zrange(sortedSet, 0, 4, function(err, replies) {
    // check if they're even still connected!
      replies.forEach(function(reply) {
        if (io.clients[reply] == undefined) {
          removeFromQueue(reply);
        }
      });
    });
}

function logAnalytics(method) {
  console.log("+++++++++++++\n" + method);
  console.log('Votes for Stream 1: ' + vote1);
  console.log('Votes for Stream 2: ' + vote2);
  console.log('Flags for Stream 1: ' + flag1);
  console.log('Flags for Stream 2: ' + flag2);
  //redis_client.zrange(sortedSet, 0, -1, function(err, replies) {
    console.log(replies.length + " in queue:");
    //replies.forEach(function(reply, i) {
      console.log("    " + i + ": " + reply);
      console.log("+++++++++++++\n");
    //});
  //});

}

// Start the server
server.listen(port);

// /////////////////////////////////////////
// Routes //
// /////////////////////////////////////////

server.get('/', function(req, res) {
  req.session.cookie.expires = false;
  res.render('index.jade', { locals : { header : 'SharkVideo', footer : '&copy;SharkMob', title : 'SharkVideo', sessionKey : req.sessionID } });
});

console.log('Listening on http://0.0.0.0:' + port);
