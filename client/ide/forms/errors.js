Template.Alerts.helpers({
	alerts: function() {
		return Alerts.find();
	}
});

Template.Alert.helpers({
	
	alertType: function() {
		if (this.type === 'template' && this.status === 'success') {
			return 'Success: ';
		} else if (this.type === 'template') {
			return 'Template Error: ';
		} else if (this.type === 'runtime') {
			return 'Runtime Error: ';
		} else {
			console.log('alertType else case firing')
		}
	}
});

Template.Alert.events({
	'click .alert .close': function(e, tmpl) {
		tmpl.find(".alert").remove();
	}
});

Template.Alert.onRendered(function() {
	var error = this.data;
	if (error.status === 'success') {
		Meteor.setTimeout(function () {
			Alerts.remove(error._id);
		}, 3000);
		//Remove success alert from session variable
	}
	
});
