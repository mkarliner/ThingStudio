
Template.Debug.helpers({
	messages: function(){
		return Messages.find({});
	},
	outbox: function(){
		return Outbox.find({});
	}
})