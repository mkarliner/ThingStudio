Template.DashboardBody.onRendered(function() {
	$('ul.tabs').tabs();
	$('.tooltipped').tooltip({delay: 50});
});

Template.DashboardBody.onDestroyed(function () {
	$('.tooltipped').tooltip('remove');
});

Template.DashboardBody.events({
	'click .select-app': function(ev) {
		ev.preventDefault();
		changeActiveApp(this._id);
	}
});


Template.DashboardBody.helpers({
	appslist: function() {
		return Apps.find().fetch();
	},
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
			return 'No connection set'
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
	appPathInfo: function(){
		return {appid: this._id}
	}
});
