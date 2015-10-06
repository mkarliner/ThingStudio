Template.FeedsHeader.rendered = function() {
  this.$('.dropdown-button').dropdown({
      inDuration: 300,
      outDuration: 225,
      constrain_width: false, // Does not change width of dropdown to that of the activator
      hover: false, // Activate on hover
      gutter: 0, // Spacing from edge
      belowOrigin: false // Displays dropdown below the button
  });
};

Template.FeedsBody.helpers({
	// allfeedslist: function(){
	// 	var mqttfeeds = Feeds.find().fetch();
	// 	for (var i = 0; i < mqttfeeds.length; i++) {
	// 		mqttfeeds[i].transport = "mqtt"
	// 	}
	// 	var httpfeeds = HTTPFeeds.find().fetch();
	// 	for (var i = 0; i < httpfeeds.length; i++) {
	// 		httpfeeds[i].transport = "http"
	// 	}
	// 	var combinedlist = mqttfeeds.concat(httpfeeds);
	// 	// console.log("here is combinedlist: ", combinedlist);
	// 	return combinedlist;
	// },
	mqttFeedsList: function () {
		return Feeds.find().fetch();
	},
	httpFeedsList: function () {
		return HTTPFeeds.find().fetch();
	},
	mqttFeedDetails: function () {
		var result = [];
		for (var i in this) {
			if (i === "pubsub" || i === "subscription") {
				result.push(i + ": " + this[i])
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
