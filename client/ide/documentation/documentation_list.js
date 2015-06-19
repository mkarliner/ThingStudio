Template.OldDocumentationBody.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.DocumentationBody.onRendered(function() {
	$('ul.tabs').tabs();
});


Template.OldDocumentationBody.helpers({
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


Template.DocumentationBody.helpers({
	docs: function(category){
		d =  Docs.find({"attributes.group": category}, {sort: {pagenumber: 1}});
		console.log("DCS ", d)
		return d;
	},
	log: function() {
		console.log(this)
	},
	publishedDate: function(date) {
		return moment(date).format('MMMM D, YYYY');
	}
})