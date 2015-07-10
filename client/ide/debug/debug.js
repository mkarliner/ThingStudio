Template.DebugBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.DebugOverlay.events({
	'click .view-full-debug': function(e, tmpl) {
		debugOps();
	}
});

Template.DebugBody.helpers({
	feeds: function() {
		return Feeds.find();
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}
			
		}
		catch(err){
			return err + " " + this
		}
	}
})

Template.DebugSubscribe.helpers({
	messages: function(){
		return Messages.find({});
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}
			
		}
		catch(err){
			return err + " " + this
		}
	}
});

Template.DebugPublish.helpers({
	outbox: function(){
		return Outbox.find({});
	},
	payload: function(){
		try {
			jstr = JSON.stringify(this.payload);
			if(jstr.length > 15) {
				return jstr.substring(0,15)+"...";
			} else {
				return jstr;
			}
			
		}
		catch(err){
			return err + " " + this
		}
	}
});