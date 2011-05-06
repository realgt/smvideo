$(document).ready(function() {
  jQuery.i18n.properties({ name : 'offline', path : '/locale/', mode : 'both', language : detectedLang, callback : function() {
    $("#emailLabel").text(emailLabel);
    $("#email")[0].value=emailPrompt;
    $("#submitButton")[0].value=submitLabel;
  } });
});

function submitForm() {
  $.ajax({
    url: '/addEmail?email=' + $("#email")[0].value,
    success: function(data) {
      $("#emailForm").hide();
      $('#emailLabel').text(thankYouLabel);      
    }
  });
}