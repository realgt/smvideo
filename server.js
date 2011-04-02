var connect = require('connect'), express = require('express'), sys = require('sys'), io = require('socket.io'), RedisStore = require('connect-redis'), redis_client = require(
    "redis").createClient(), port = (process.env.PORT || 8081);

var stat = __dirname + '/static';
// Setup Express
var server = express.createServer();
server.configure(function() {
  server.set('views', __dirname + '/views');
  server.set('view engine', 'jade');
  server.use(express.compiler( { src : stat, enable : [ 'sass' ] }));
  server.use(express.bodyParser());
  server.use(express.cookieParser());
  server.use(express.session( { key : 'api-key', secret : 'api secret', store : new RedisStore }));
  server.use(express.static(stat));
  server.use(server.router);
});

vote1 = 0;
vote2 = 0;
flag1 = 0;
flag2 = 0;

var thresholdTime = 0;
var sortedSet = "zSet";
var leaderSet = "zLeaders";
var q = [];
var leaders = [];
var stream1Client = '';
var stream2Client = '';
var loserClient = '';

// clean up the db
console.log("Cleaning up the db!");
redis_client.ZREMRANGEBYSCORE(sortedSet, "-inf", "+inf");

// Setup Socket.IO
var io = io.listen(server);
io.on('connection', function(client) {

  // TODO: find a better place for this?
    // get leaderboard
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

    client.on('disconnect', function() {
      // todo remove connection_id from hashmaan
        removeFromQueue(client.sessionId);

      });

    client.on('message', function(message) {
      var localMsg = message.substr(0, 4);
      console.log('Client ' + client.sessionId + ' says : ' + message);

      if (message == 'queue') {
        addToQueue(client.sessionId);
      }
      else if (localMsg == 'vote') {
        if (message == 'vote:1') {
          vote1++;
        }
        else if (message == 'vote:2') {
          vote2++;
        }

        logAnalytics("vote!");
      }
      else if (localMsg == 'flag') {
        if (message == 'flag:1') {
          flag1++;
        }
        else if (message == 'flag:2') {
          flag2++;
        }

        logAnalytics("flag!");
      }

      redis_client.zcard(sortedSet, function(err, reply) {
        console.log("ZCARD returns: " + reply);
        if (vote1 > (reply / 2)) {
          console.log("stream1 won!");
          loserClient = stream2Client;
          stream2Client = '';
        }
        else if (vote2 > (reply / 2)) {
          console.log("stream2 won!");
          loserClient = stream1Client;
          stream1Client = '';
        }

        if (flag1 > (reply / 10)) {
          console.log("stream1 flagged!");
          loserClient = stream1Client;
          stream1Client = '';
        }
        else if (flag2 > (reply / 10)) {
          console.log("stream2 flagged!");
          loserClient = stream2Client;
          stream2Client = '';
        }

      });
      if (loserClient != '') {
        removeFromQueue(loserClient);
        loserClient = '';
        vote1 = 0;
        vote2 = 0;
        flag1 = 0;
        flag2 = 0;
        // TODO: broadcast the winner!
        logAnalytics("LOSER LOG:");
      }
      handleQueue();
    });
    handleQueue();
  });

function addToQueue(clientId) {
  var ts = Math.round(new Date().getTime() / 1000.0);
  redis_client.zadd(sortedSet, ts, clientId, function(err, response) {
    console.log(clientId + " added to queue with epoch: " + ts);
  });
  handleQueue();
}

function removeFromQueue(clientId) {

  // get the time for the nth record (leader threshold)
  if (thresholdTime == 0) {
    redis_client.zrevrange(leaderSet, 10, 10, "WITHSCORES", function(err, results) {
      if (results[0] != undefined) {
        thresholdTime = results[1];// score for the 10th item!
      }
    });
  }
  // Get the record
  redis_client.zscore(sortedSet, clientId, function(err, results) {
    if (results != null) {
      var ts = Math.round(new Date().getTime() / 1000.0);
      // before we remove, lets check how long they broadcast for
      var broadcastTime = ts - results;

      if (broadcastTime > thresholdTime) {
        // found a winner!
      console.log("adding a new item to the leaderboard! " + clientId);
      redis_client.zadd(leaderSet, broadcastTime, clientId);
      thresholdTime = 0;
      leaders.length==0;
      if (io.clients[clientId] != undefined)
        io.clients[clientId].send( { message : 'leaderboard' });
    }
    redis_client.zrem(sortedSet, clientId, function(err, response) {
      console.log(clientId + " removed from queue");
      if (io.clients[clientId] != undefined)
        io.clients[clientId].send( { message : 'stopStream' });
    });
  }

} );

  if (stream1Client == clientId) {
    stream1Client == '';
  }
  else if (stream2Client == clientId) {
    stream2Client == '';
  }

  handleQueue();
}

function handleQueue() {

  redis_client.zrange(sortedSet, 0, 4, function(err, replies) {
    // check if they're even still connected!
      replies.forEach(function(reply, i) {
        if (io.clients[reply] == undefined) {
          removeFromQueue(reply);
        }
      });
    });
  var msg = '';
  // now after queueing, voting, and flagging, lets send streams!
  redis_client.zrange(sortedSet, 0, 1, function(err, replies) {
    replies.forEach(function(reply, i) {
      // logic to keep from switching cameras
        if (stream1Client == '') {
          stream1Client = reply;
          if (io.clients[reply] != undefined)
            io.clients[reply].send( { message : "stream1" });
          console.log(reply + " should be publishing to stream1");
        }
        else if (stream2Client == '' && stream1Client != reply) {
          stream2Client = reply;
          if (io.clients[reply] != undefined)
            io.clients[reply].send( { message : "stream2" });
          console.log(reply + " should be publishing to stream2");
        }
      });

  });
  //io.broadcast({message: "stopStream"}, [stream1Client, stream2Client]);
  logAnalytics("handleQueue");
  msg = '';
}
function logAnalytics(method) {
  console.log("+++++++++++++\n" + method);
  console.log('Votes for Stream 1: ' + vote1);
  console.log('Votes for Stream 2: ' + vote2);
  console.log('Flags for Stream 1: ' + flag1);
  console.log('Flags for Stream 2: ' + flag2);
  console.log("stream1Client " + stream1Client);
  console.log("stream2Client " + stream2Client);
  console.log("loserClient " + loserClient);
  redis_client.zrange(sortedSet, 0, -1, function(err, replies) {
    console.log(replies.length + " in queue:");
    replies.forEach(function(reply, i) {
      console.log("    " + i + ": " + reply);
      console.log("+++++++++++++\n");
    });
  });

}

// Start the server
server.listen(port);

// /////////////////////////////////////////
// Routes //
// /////////////////////////////////////////

server.get('/', function(req, res) {
  res.render('index.jade', { locals : { header : 'SharkVideo', footer : '&copy;SharkMob', title : 'SharkVideo' } });
});

console.log('Listening on http://0.0.0.0:' + port);
