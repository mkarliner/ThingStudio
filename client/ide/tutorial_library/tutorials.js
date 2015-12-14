Template.TutorialsBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.TutorialsBody.helpers({
	log: function () {
		console.log("this right now: ", this)
	},
	tuts: function () {
		return Tutorials.find();
	}
})
