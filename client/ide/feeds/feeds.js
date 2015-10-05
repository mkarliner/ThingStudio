Template.FeedsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.FeedsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.FeedsBody.helpers({
	allfeedslist: function(){
		var mqttfeeds = Feeds.find().fetch();
		for (var i = 0; i < mqttfeeds.length; i++) {
			mqttfeeds[i].transport = "mqtt"
		}
		var httpfeeds = HTTPFeeds.find().fetch();
		for (var i = 0; i < httpfeeds.length; i++) {
			httpfeeds[i].transport = "http"
		}
		var combinedlist = mqttfeeds.concat(httpfeeds);
		// console.log("here is combinedlist: ", combinedlist);
		return combinedlist;
	},
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
	log: function () {
		console.log("in each, this is: ", this)
	},
	publicfeeds: function() {
		return Feeds.find({public: true})
	},
	ownerName: function(){
		owner = Meteor.users.findOne({_id: this.owner});
		return owner ? owner.username : "Owner Unknown";
	}
});
