Template.ConnectionStatus.helpers({
	status: function(){
		if(Session.get("ConnectionStatus") == true) {
			return  "Connected";
		} else {
			return "Disconnected"
		}			
	},
	name: function(){
		conn = Session.get("currentConnection");
		if(conn) {
			return conn.title;
		} else {
			return "None"
		}
		
	},
	host: function(){
		conn = Session.get("currentConnection");
		if(conn) {
			return conn.host;
		} else {
			return "No host"
		}
		
	},
		
});