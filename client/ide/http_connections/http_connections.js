Template.HTTPConnectionsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.HTTPConnectionsHeader.helpers({
	// http_connectionName: function() {
	// 	return getCurrentHTTPConnection().title;
	// }
});

Template.HTTPConnectionsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.HTTPConnectionsBody.events({
	'click .http_connect': function(ev){
		http_connect(this); //Legacy http_connection click
	}
});

Template.HTTPConnectionsBody.helpers({
	http_connectionlist: function(){
		//console.log("CONN FND: ", HTTPConnections.find({}).fetch())
		return HTTPConnections.find({});
	},
	// HTTPConnection_status: function(){
	// 	return Session.get("HTTPConnectionStatus") ? "http_connected" : "dishttp_connected";
	// }
	foreignHTTPConnections: function(){
		fc = Session.get("foreignHTTPConnections");
		return fc;
	},
	username: function(id) {
		return Meteor.users.findOne(id).username;
	},
	showUsername: function() {
		if ( this.username ) {
			return this.username;
		} else {
			return;
		}
	},
	showObscuredPassword: function() {
		if ( this.password ) {
			return '\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF'
		} else {
			return;
		}
	},
	http_connectionIsActive: function() {
		return currentHTTPConnection();
	}
});


