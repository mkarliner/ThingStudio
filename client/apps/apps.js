Template.Apps.helpers({
	appslist: function(){
		return Apps.find({})
	},
	shareable: function(){
		if(this.access == "Shareable" || this.access=="Published") {
			return true;
		} else {
			return false;
		}
	},
	current_app: function(){
		if(this._id == Session.get("currentApp")._id) {
			return true;
		} else {
			return false;
		}
	},
	parentTitle: function(){
		return(Apps.findOne({_id: this.parent})).title;
	}
});

Template.Apps.events({
	'click #select-app': function(ev) {
		ev.preventDefault();
		console.log(this);
		UnsubscribeAll();
		DisconnectMQTT();
		Session.setPersistent("currentApp",this);
		ResetMessages();
	}
	
});

