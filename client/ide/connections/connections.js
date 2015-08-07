Template.ConnectionsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.ConnectionsHeader.helpers({
	connectionName: function() {
		return getCurrentConnection().title;
	}
});

Template.ConnectionsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.ConnectionsBody.events({
	'click .connect': function(ev){
		connect(this); //Legacy connection click
	}
});

Template.ConnectionsBody.helpers({
	connectionlist: function(){
		//console.log("CONN FND: ", Connections.find({}).fetch())
		return Connections.find({});
	},
	// Connection_status: function(){
	// 	return Session.get("ConnectionStatus") ? "connected" : "disconnected";
	// }
	foreignConnections: function(){
		fc = Session.get("foreignConnections");
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
	connectionIsActive: function() {
		return currentConnection();
	}
});


