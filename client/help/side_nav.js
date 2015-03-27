Template.sideNav.helpers({
	helppages: function(group){
		console.log(group.hash.group);
		return HelpPages.find({group: group.hash.group}, {sort: {pagenumber: 1}});
	}
});

Template.sideNav.events({
	'click ul#sidebar li.top' : function(e) {		
		if ($(e.target).parent().hasClass("active")) {
			console.log("clicked has class, removing active");
			// $(e.target).parent().removeClass("active");
		} else {
			console.log("clicked does not have class, adding active");
			$(e.target).parent().siblings().removeClass("active");
			$(e.target).parent().addClass('active');
		}
	}
});