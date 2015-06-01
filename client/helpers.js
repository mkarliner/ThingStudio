Template.registerHelper( 
	"gravatar", function(){
		return Gravatar.imageUrl(Meteor.user().emails[0].address);
	}
);

Template.registerHelper(
	"curr_app_name", function() {
		return Session.get("currentApp").title;
	}
);

Template.registerHelper("indexedArray",
	function(arr) {
  	  	return _.map(arr, function(value, index){
    	  return {value: value, index: index};
  });
});

Template.registerHelper("menuOps", 
	menuOps = function() {
		if ( $('#item-insert').hasClass('td-open') ) {
			//Is open
			$('main tr#item-insert').toggleClass('td-open');
			$('main div.add-new-item').removeClass('open').css({opacity: 1.0}).animate({opacity: 0.0}, 100);
			// $('#insertItemForm')[0].reset();
			AutoForm.resetForm('insertItemForm');
			redrawSideNavSelect();
		} else {
			//Is closed
			$('main tr#item-insert').toggleClass('td-open');
			$('main div.add-new-item').addClass('open').css({opacity: 0.0}).animate({opacity: 1.0}, 100);
			$('#insertItemForm input.first').focus();
		}
	}
);

Template.registerHelper("deviceOrientation", function(){
	console.log("DEVO ", Session.get("deviceOrientation"))
	return Session.get("deviceOrientation");
})

Template.registerHelper("appTreeList", function(){
	return Session.get("appTreeList");
})

Template.registerHelper("themeOptions", function() {
	return;
});