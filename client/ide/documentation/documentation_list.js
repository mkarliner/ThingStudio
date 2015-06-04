Template.DocumentationBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.DocumentationBody.helpers({
	docs: function(category){
		return HelpPages.find({group: category}, {sort: {pagenumber: 1}});
	},
	log: function() {
		console.log(this)
	},
	publishedDate: function(date) {
		return moment(date).format('MMMM D, YYYY');
	}
})