Template.jqKnob.onRendered(function(){
			console.log("KOBB", this, this.data)
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