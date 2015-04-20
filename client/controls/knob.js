Template.jqKnob.onRendered(function(){
	        $(".dial").knob({
	        	"release": function(v) {
	        		console.log("KNOB: ", v, this);
	        	}
	        });
});

Template.jqKnob.helpers({
	message: function(feed){
		msg = Messages.findOne({
			feed: feed
		});
		return msg ? msg.message : "-";
	},
})