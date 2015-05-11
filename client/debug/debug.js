
Template.Debug.helpers({
	feeds: function() {
		return Feeds.find();
	},
	messages: function(){
		return Messages.find({});
	},
	outbox: function(){
		return Outbox.find({});
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	}
})