Template.errors.helpers({
	Errors: function() {
		return Errors.find();
	}
});

Template.error.helpers({
	alertType: function() {
		return 'success';
	}
});

Template.error.events({
	'click .alert .close': function(e, tmpl) {
		console.log(this);
		var myItem = tmpl.find(".error");
		console.log(myItem)
	}

});

// Template.error.onRendered(function() {
// 	var error = this.data;
// 	Meteor.setTimeout(function () {
// 		Errors.remove(error._id);
// 	}, 3000);
// });
