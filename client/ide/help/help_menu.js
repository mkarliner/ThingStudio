Template.DocumentationListBody.helpers({
	docs: function(){
		return HelpPages.find({}, {sort: {pagenumber: 1}});
	}
})