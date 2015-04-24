Template.Feeds.helpers({
	feedlist: function(){
		console.log("feeds")
		return Feeds.find({})
	},
	ownerName: function(){
		owner = Meteor.users.findOne({_id: this.owner});
		return owner ? owner.username : "Owner Unknown";
	}
});



Template.Feeds.events({
	'click #subscribe-button': function(ev){
		console.log("Boo");		
		feeds = Feeds.find({}).fetch();
		i = 0;
		for(i=0; i<feeds.length; i++){
			console.log("Subscribing to " + feeds[i].subscription);
			mqttClient.subscribe(feeds[i].subscription);
		}
	}
});

Meteor.startup(function(){
	Feeds.after.insert(function(userId, doc) {
		// console.log("New Feed: ", userId, doc);
		mqttClient.subscribe(doc.subscription);
	});
	Feeds.after.update(function(userId, doc) {
		// console.log("Updated Feed: ", userId, doc);
		mqttClient.subscribe(doc.subscription);
	});
});



