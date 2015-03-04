Template.HelpMenu.helpers({
	helppages: function(){
		return HelpPages.find({}, {sort: {pagenumber: 1}});
	}
})