Template.AppsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
		$('.add-new-item select').material_select();
	}
});

Template.AppsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		menuOps();
	}
});

Template.AppsBody.events({
	'click .select-app': function(ev) {
		ev.preventDefault();
		UnsubscribeAll();
		DisconnectMQTT();
		Session.setPersistent("currentAppId",this._id);
		ResetMessages();
		redrawSideNavSelect();
	}
});

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
	parentTitle: function(){
		if ( this.ancestor ) {
			console.log('there is an ancestor')
			return(Apps.findOne({_id: this.ancestor})).title;
		} else {
			return;
		}
		
	}
});
