Template.registerHelper("connection_status", function(){
	return Session.get("connectionStatus") ? "connected" : "disconnected";
})