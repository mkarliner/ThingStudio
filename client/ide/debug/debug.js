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