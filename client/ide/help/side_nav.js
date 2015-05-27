Template.sideNav.helpers({
	docs: function(group){
		console.log(group.hash.group);
		return HelpPages.find({group: group.hash.group}, {sort: {pagenumber: 1}});
	}
});

Template.sideNav.events({
	'click ul#sidebar li.top' : function(e) {		
		if ($(e.target).parent().hasClass("active")) {
			console.log("clicked has class, removing active");
		} else {
			console.log("clicked does not have class, adding active");
			$(e.target).parent().siblings().removeClass("active");
			$(e.target).parent().addClass('active');
		}
	},
	'click a.close-menu': function(e) {
		e.preventDefault();
		$("#main-navigation").removeClass('open');
	}
});

Template.navButton.events({
	'click a.open-menu' : function(e) {
		e.preventDefault();
		$('#main-navigation').addClass('open');
	}	
});