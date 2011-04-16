var isFlashReady = false;
window.onload = function() {
  setInterval("checkStream()", 30000);
}

var socket = new io.Socket(null, { port : 80, rememberTransport : false });

socket.connect();
socket.on('message', function(data) {
  if (data.leaders) {
    writeLeaders(data.leaders);
  }
  else if (data.stats) {
    writeStats(data.stats);
    var viewers = data.stats.viewers.toString();
    var vote1 = data.stats.vote1.toString();
    var vote2 = data.stats.vote2.toString();
    var flag1 = data.stats.flag1.toString();
    var flag2 = data.stats.flag2.toString();
    var statsString = viewers + "|" + vote1 + "|" + vote2 + "|" + flag1 + "|" + flag2;
    getMovie().setGameStats(statsString);
  }
  else if (data.queue) {
    writeQueue(data.queue);
  }
  else if (data.announcement) {
    writeAnnouncement(data.announcement);
  }
  else if (data.winner) {
    getMovie().setWinner(data.winner);
  }
  else if (data.message) {
    if (data.message == 'stopStream') {
      stopStream();
      addToQueue();
    }
    else if (data.message.substr(0, 6) == 'stream') {
      startStream(data.message);
    }
    else if (data.message == 'leaderboard') {
      writeAnnouncement('Congrats, you are on the leaderboard');
      getEntry();
    }
  }

});
socket.on('disconnect', function() {
  console.log('reconnecting...')
  socket.connect()
});
socket.on('connect_failed', function() {
  console.log('connection failed. reconnecting...')
  socket.connect()
});

function startedStreaming(streamId) {
  socket.send( { streaming : streamId });
}

function stopStream() {
  getMovie().stopStream();
}
function startStream(message) {
  getMovie().startStream(message);
}
function addToQueue() {
  if (!socket.connected) {
    setTimeout("addToQueue()", 1000);
  }
  else
  {
    socket.send( { queue : true });
  }  
  
}
function removeFromQueue() {
  socket.send( { queue : false });
}

function sendEntryData(name, url, image) {
  socket.send( { entry : { name : name, url : url, image : image } });
}

function checkStream() {
  if (!socket.connected) {
    stopStream();
    socket.connect();
  }
}
function asReady() {
  isFlashReady = true;
}
function getEntry() {
  getMovie().getEntry();

}
function writeAnnouncement(msg) {
  $("#announceText").html('<em>' + msg + '</em>');
  $("#announcement").fadeIn('slow');
}

function writeStats(stats) {
  $("#stats").html('Viewers: 4,451,78' + stats.viewers.toString());
}

function writeLeaders(leaders) {
  $("#leaders").html("");
  if (leaders[0].id != undefined)
    $("#leaderBoard").show();
  for (i = 0; i <= leaders.length - 1; i++) {
    if (leaders[i].id != undefined) {
      var leaderData = leaders[i].id.split("|");
      var id = leaderData[0];
      var name = "Anonymous";
      var image = "/images/unknown.jpg";
      var url = "#";
      if (leaderData[1])
        name = leaderData[1];
      if (leaderData[2])
        image = leaderData[2];
      if (leaderData[3])
        url = leaderData[3];

      var li1 = document.createElement('li');
      var min = Math.floor(leaders[i].ts / 60);
      var sec = leaders[i].ts - (min * 60);
      var ts = min + " min " + sec + " sec";
      $(li1).html(
          '<a alt="' + id + '" href="' + url + '"><img target="_blank" width="128" height="90"  class="leaderImage" src="' + image + '"></a><div class="leaderName">' + name
              + '</div><div class="leaderTime">' + ts + '</div>');
      $("#leaders").append(li1);
    }

  }

}

function vote(streamNum) {
  socket.send( { vote : streamNum });
}

function flag(streamNum) {
  socket.send( { flag : streamNum });
}

function getMovie() {
  if (isFlashReady)
    if (navigator.appName.indexOf("Microsoft") != -1) {
      return window['Webcam'];
    }
    else {
      return document['Webcam'];
    }
  else
    setTimeout("getMovie()", 100);
}