var connect = require('connect')
  , express = require('express')
  , sys = require('sys')
  , io = require('socket.io')
  , port = (process.env.PORT || 8081);


//Setup Express
var server = express.createServer();
server.configure(function(){
  server.set('views', __dirname + '/views');
  server.use(express.bodyParser());
  server.use(express.cookieParser());
  server.use(express.session({key: 'api-key', secret: 'api secret'}));
  server.use(express.static(__dirname + '/static'));
  server.use(server.router);
});


//Setup Socket.IO
var io = io.listen(server);
io.on('connection', function(client){
    console.log('Client Connected');
    client.on('connect', function(message){
      console.log('Client Connected.');
    });
    client.on('disconnect', function(){
      console.log('Client Disconnected.');
    });
});

//Start the server
server.listen( port);



///////////////////////////////////////////
//Routes //
///////////////////////////////////////////

server.get('/', function(req,res){
  res.render('index.jade', {
   locals : {
     header: 'SharkVideo'
     ,footer: '&copy;SharkMob'
     ,title : 'SharkVideo'
   }
  });
});

console.log('Listening on http://0.0.0.0:' + port );