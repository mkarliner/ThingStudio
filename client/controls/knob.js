Template.jqKnob.rendered = function(){
	        $(".dial").knob();;
}

Template.jqKnob.helpers({
	message: function(feed){
		msg = Messages.findOne({
			feed: feed
		});
		return msg ? msg.message : "no data yet";
	},
})