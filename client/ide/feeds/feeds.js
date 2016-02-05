Template.FeedsHeader.rendered = function() {
  this.$('.dropdown-button').dropdown({
      inDuration: 300,
      outDuration: 225,
      constrain_width: false, // Does not change width of dropdown to that of the activator
      hover: false, // Activate on hover
      gutter: 15, // Spacing from edge
      belowOrigin: false // Displays dropdown below the button
  });
};

Template.FeedsBody.helpers({
	mqttFeedsList: function () {
		return Feeds.find().fetch();
	},
	httpFeedsList: function () {
		return HTTPFeeds.find().fetch();
	},
	mqttFeedDetails: function () {
		var result = [];
		for (var i in this) {
			if ( i === "pubsub" ) {
				result.push(i + ": " + this[i])
			} else if ( i === "subscription" ) {
        result.push("topic: " + this[i])
      }
		}
		return result.join(", ");
	},
	httpFeedDetails: function () {
		var result = [];
		for (var i in this) {
			if (i === "path" || i === "polling_interval" || i === "verb") {
				result.push(i + ": " + this[i])
			}
		}
		return result.join(", ");
	},
	// log: function () {
	// 	console.log("in each, this is: ", this)
	// },
	publicfeeds: function() {
		return Feeds.find({public: true})
	},
	ownerName: function(){
		owner = Meteor.users.findOne({_id: this.owner});
		return owner ? owner.username : "Owner Unknown";
	}
});

Template.FeedsHeader.events({
	'click #new-mqtt-feed': function(e, templ){
		e.preventDefault();
		var app = getCurrentApp();
		if( app.connection == "none" || !app.connection ) {
			sAlert.warning("You must select an MQTT connection for your App first, go to App properties");
		} else {
			Router.go('New MQTT Feed');
		}
	}
})
