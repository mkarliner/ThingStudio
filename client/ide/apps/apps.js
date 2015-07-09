Template.AppsBody.onRendered(function() {
	$('.tooltipped').tooltip({delay: 50});
	$('ul.tabs').tabs();
});

Template.AppsHeader.events({
	"click .header-action-1": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.AppsNewItem.events({
	"click .table-cancel-new": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	},
	"click .divider-decoration": function(e, tmpl) {
		e.preventDefault();
		menuOps();
	}
});

Template.AppsBody.events({
	'click .select-app': function(ev) {
		ev.preventDefault();
		changeActiveApp(this._id);
	}
});

Template.AppsBody.helpers({
	appslist: function(){
		return Apps.find({})
	},
	shareable: function(){
		if(this.shareable) {
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

Template.AppList.helpers({
	current_app: function(){
		if(this._id == Session.get("currentAppId")) {
			return true;
		} else {
			return false;
		}
	},
	showSummary: function() {
		var mySummary = this.summary
		if ( mySummary ) {
			return mySummary
		} else {
			return 'No summary set'
		}
	},
	showConnectionTitle: function() {
		var connection = Connections.find({_id: this.connection}).fetch()
		if ( connection.length > 0 ) {
			connectionTitle = connection[0].title
			return connectionTitle
		} else {
			return 'No home screen set'
		}
	},
	showHomePage: function() {
		var home = Screens.find({_id: this.home_page}).fetch()
		if ( home.length > 0 ) {
			homeTitle = home[0].title
			return homeTitle
		} else {
			return 'No home screen set'
		}
	},
	showShareable: function() {
		var isShareable = this.shareable
		if ( isShareable === true ) {
			return 'Yes'
		} else {
			return 'No'
		}
	},
	showPublic: function() {
		var isPublic = this.public
		if ( isPublic === true ) {
			return 'Yes'
		} else {
			return 'No'
		}
	},
	showDescription: function() {
		var myDescription = this.description
		if ( myDescription ) {
			return myDescription
		} else {
			return 'No description set'
		}
	},
});
