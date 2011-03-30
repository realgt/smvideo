var connect = require('connect'), express = require('express'), sys = require('sys'), io = require('socket.io'), port = (process.env.PORT || 8081);

var stat = __dirname + '/static';
// Setup Express
var server = express.createServer();
server.configure(function() {
  server.set('views', __dirname + '/views');
  server.set('view engine', 'jade');
  server.use(express.compiler( { src : stat, enable : [ 'sass' ] }));
  server.use(express.bodyParser());
  server.use(express.cookieParser());
  server.use(express.session( { key : 'api-key', secret : 'api secret' }));
  server.use(express.static(stat));
  server.use(server.router);
});

vote1 = 0;
vote2 = 0;
flag1 = 0;
flag2 = 0;

q = [];
stream1Client = '';
stream2Client = '';
loserClient = '';

// Setup Socket.IO
var io = io.listen(server);
io.on('connection', function(client) {

  client.on('disconnect', function() {
    // todo remove connection_id from hashmaan
      console.log('Client Disconnected.');
      // TODO: remove client_id from list
    });

  client.on('message', function(message) {
    console.log('Client ' + client.sessionId + ' says : ' + message);

    if (message == 'queue') {
      // var ts = Math.round(new Date().getTime() / 1000.0);
      // console.log(client + " " + ts);
      q.push(client.sessionId);
    }
    else if (message.substr(0, 4) == 'vote') {
      if (message == 'vote:1') {
        vote1++;
        logAnalytics();
      }
      else if (message == 'vote:2') {
        vote2++;
        logAnalytics();
      }
      if (vote1 > (q.length / 2)) {
        // stream1 won!
        loserClient = stream2Client;
        stream2Client = '';
      }
      else if (vote2 > (q.length / 2)) {
        // stream2 won!
        loserClient = stream1Client;
        stream1Client = '';
      }
    }
    else if (message.substr(0, 4) == 'flag') {
      if (message == 'flag:1') {
        flag1++;
      }
      else if (message == 'flag:2') {
        flag2++;
      }
      if (flag1 > (q.length / 10)) {
        // stream1 flagged!!
        loserClient = stream1Client;
        stream1Client = '';
      }
      else if (flag2 > (q.length / 10)) {
        // stream2 flagged!!
        loserClient = stream2Client;
        stream2Client = '';
      }
    }
    if (loserClient != '') {
      logAnalytics();
      // now get rid of losers!
      if (q[0] == loserClient) {
        q.shift();

      }
      else if (q[1] == loserClient) {
        q.splice(1, 1);
      }
      vote1 = 0;
      vote2 = 0;
      flag1 = 0;
      flag2 = 0;
      logAnalytics();
    }
    handleQueue(client);
  });
  handleQueue(client);
});

function handleQueue(client)
{
  var msg = '';
  // now after queueing, voting, and flagging, lets send streams!
  if (q[0] == client.sessionId || q[1] == client.sessionId) {
    if (stream1Client == '') {
      stream1Client = client.sessionId;
      msg = "stream1";
    }
    else if (stream2Client == '' && stream1Client != client.sessionId) {
      stream2Client = client.sessionId;

    }

    if (stream1Client == client.sessionId)
      msg = "stream1";
    else if (stream2Client == client.sessionId)
      msg = "stream2";
    client.send( { message : msg });
    logAnalytics();
  }
  msg = '';
}
function logAnalytics()
{
  console.log('Votes for Stream 1: ' + vote1);
  console.log('Votes for Stream 2: ' + vote2);
  console.log("q[0]: " + q[0]);
  console.log("q[1]: " + q[1]);
  console.log("in q: " + q.length)
  console.log("stream1Client " + stream1Client);
  console.log("stream2Client " + stream2Client);
  console.log("loserClient " + loserClient);
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
