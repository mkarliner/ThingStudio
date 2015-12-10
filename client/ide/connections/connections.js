Template.ConnectionsHeader.rendered = function() {
  this.$('.dropdown-button').dropdown({
      inDuration: 300,
      outDuration: 225,
      constrain_width: false, // Does not change width of dropdown to that of the activator
      hover: false, // Activate on hover
      gutter: 15, // Spacing from edge
      belowOrigin: false // Displays dropdown below the button
  });
};

// Template.ConnectionsHeader.events({
// 	"click .header-action-1": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	}
// });

Template.ConnectionsHeader.helpers({
	connectionName: function() {
		return getCurrentConnection().title;
	}
});

// Template.ConnectionsNewItem.events({
// 	"click .table-cancel-new": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	},
// 	"click .divider-decoration": function(e, tmpl) {
// 		e.preventDefault();
// 		menuOps();
// 	}
// });

// Template.ConnectionsBody.events({
// 	'click .connect': function(ev){
// 		connect(this); //Legacy connection click
// 	}
// });

Template.ConnectionsBody.helpers({
	mqttConnectionList: function(){
		//console.log("CONN FND: ", Connections.find({}).fetch())
		return Connections.find({});
	},
	httpConnectionList: function(){
		//console.log("CONN FND: ", HTTPConnections.find({}).fetch())
		return HTTPConnections.find({});
	},
	mqttConnectionDetails: function () {
		var result = [];
		for (var i in this) {
			if (i === "host" || i === "port" || i === "protocol") {
				result.push(i + ": " + this[i])
			}
      if (i === "username") {
        result.push("authentication: true")
      }
		}
		return result.join(", ");
	},
	httpConnectionDetails: function () {
		var result = [];
		for (var i in this) {
			if (i === "host" || i === "port" || i === "protocol") {
				result.push(i + ": " + this[i])
			}
      if (i === "username") {
        result.push("authentication: true")
      }
		}
		return result.join(", ");
	},
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
