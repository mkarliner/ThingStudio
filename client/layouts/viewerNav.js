Template.registerHelper("Connection_status", function(){
	return Session.get("ConnectionStatus") ? "connected" : "disconnected";
});



