var isFlashReady = false;
var flashLabels;
var movie;
var socket = new io.Socket(null, { port : 80, rememberTransport : false });

window.onload = function() {
  if (!socket.connected)
    socket.connect();
  setInterval("checkStream()", 30000);

  // set labels using js
  jQuery.i18n.properties({ name : 'index', path : '/locale/', mode : 'both', language : detectedLang, callback : function() {
    $(".howItWorksLabel").text(how_it_works_label);
    $(".leaderBoardLabel").text(hall_of_fame);
    $("#howItWorksText").text(how_it_works_text);
    $('#contactUsLink').text(contact_us);
    $('#pickOne').text(pick_one);
    $('#statsLabel').text(viewers);
    flashLabels = vote + "|" + flag;
    if (getMovie()) getMovie().setLabels(flashLabels);
  } });
};

socket.connect();
socket.on('message', function(data) {
  if (data.leaders) {
    writeLeaders(data.leaders);
  }
  else if (data.gamestats) {
    writeStats(data.gamestats);
  }
  else if (data.queue) {
    writeQueue(data.queue);
  }
  else if (data.announcement) {
    var msg = jQuery.i18n.prop(data.announcement);
    switch (data.announcement)
    {
      case "inQueue":
      {
        writeAnnouncement(msg);
        break;
      }
      case "warnLive":
      {
        writeWarning(msg);
        break;
      }
      case "leaderboard":
      {
        writeAnnouncement(msg);
        getEntry();
        break;
      }
    }
  }
  else if (data.winner) {
    getMovie().setWinner(data.winner);
  }
  else if (data.message) {
    if (data.message == 'stopStream') {
      stopStream();
      addToQueue();
    }
    else if (data.message == "newbattle") {
      getMovie().startBattle();
    }
    else if (data.message.substr(0, 6) == 'stream') {
      startStream(data.message);
    }
  }

});
socket.on('disconnect', function() {
  console.log('reconnecting...');
  socket.connect();
});
socket.on('connect_failed', function() {
  console.log('connection failed. reconnecting...');
  socket.connect();
});

function startedStreaming(streamId) {
  socket.send({ streaming : streamId });
}
window['startedStreaming'] = startedStreaming;

function stopStream() {
  getMovie().stopStream();
}
function startStream(message) {
  $("#warning").fadeOut("slow");
  getMovie().startStream(message);
}
function addToQueue() {
  if (!socket.connected) {
    setTimeout("addToQueue()", 1000);
  }
  else {
    socket.send({ queue : true });
  }

}

function abortStream(stream) {
  socket.send({ abortStream : stream });
}
window['abortStream'] = abortStream;

function voteStream(streamNum) {
  socket.send({ vote : streamNum });
}
window['voteStream'] = voteStream;

function flagStream(streamNum) {
  socket.send({ flag : streamNum });
}
window['flagStream'] = flagStream;
function removeFromQueue() {
  socket.send({ queue : false });
}

function sendEntryData(name, url, image) {
  socket.send({ entry : { name : name, url : url, image : image } });
}

function checkStream() {
  if (!socket.connected) {
    stopStream();
    socket.connect();
  }
}

function asReady() {
  isFlashReady = true;
  if (flashLabels) 
    getMovie().setLabels(flashLabels);
}
window['asReady'] = asReady;
function getEntry() {
  getMovie().getEntry();
}

function writeAnnouncement(msg) {
  $("#announceText").html('<em>' + msg + '</em>');
  $("#announcement").fadeIn('slow');
  setTimeout("$('#announcement').fadeOut('slow')", 5000);
}

function writeWarning(msg) {
  $("#warnText").html(msg);
  $("#warning").fadeIn("slow");
}

function writeStats(stats) {
  if (getMovie())
    getMovie().updateStats(stats);
  var viewers = stats.split("|")[0];
  $("#statsCount").text(": " +viewers);
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
          '<a target="_blank" alt="' + id + '" href="' + url + '"><img width="128" height="90"  class="leaderImage" src="' + image
              + '"></a><div class="leaderName">' + name + '</div><div class="leaderTime">' + ts + '</div>');
      $("#leaders").append(li1);
    }

  }

}



function getMovie() {
  if (!movie) {
    var movieName = 'Webcam';
    if (isFlashReady) {
      try {
        movie = document[movieName];
        // movie = document.getElementById(movieName);
        movie = (movie == null || movie == undefined) ? window[movieName] : movie;
      }
      catch (e) {
        return null;
      }
      return movie;
    }
    else {
      // setTimeout("getMovie()", 1000);
    }
  }
  return movie;

}