Template.AppsBody.helpers({
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
		if(this._id == Session.get("currentAppId")) {
			return true;
		} else {
			return false;
		}
	},
	// parentTitle: function(){
	// 	return(Apps.findOne({_id: this.parent})).title;
	// }
});

Template.AppsBody.events({
	'click #select-app': function(ev) {
		ev.preventDefault();
		console.log(this._id);
		UnsubscribeAll();
		DisconnectMQTT();
		Session.setPersistent("currentAppId",this._id);
		ResetMessages();
		redrawSideNavSelect();
	}
});

