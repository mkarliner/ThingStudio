Template.ConnectionStatus.helpers({
	status: function(){
		return  Session.get("ConnectionStatus");
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