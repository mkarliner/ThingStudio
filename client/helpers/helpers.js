getCurrentApp = function() { 
	app =  Apps.findOne({_id: Session.get("currentAppId")});
	return app;
};

getCredentials = function(){
	return Session.get("currentCredentials");
}

setCredentials = function(cred){
	 Session.set("currentCredentials", cred);
	 Session.set("authReady", true);
}


// startConnection = function(){
// 	//Called from the onReady function of connections.
// 	app = getCurrentApp();
// 	//Is there a connection defined for this app?
// 	if(app.connection) {
// 		connection = Connections.findOne({_id: app.connection})
// 		Session.set("currentConnection", connection );
// 		connect(connection);
// 	}
//
// }

getCurrentConnection = function() {
	return  Session.get("currentConnection");
}

setCurrentConnection = function(conn, from){
	//console.log("Setting current connection to: ", from,  conn);
	Session.set("currentConnection", conn);
}

Template.registerHelper( 
	"gravatar", function(){
		if(Meteor.user()) {
			return Gravatar.imageUrl(Meteor.user().emails[0].address);
		}
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
		if ( $('main div.add-new-item').hasClass('open') ) {
			//Is open
			$('main tr#item-insert').toggleClass('form-open');
			$('main div.single-page-container').toggleClass('form-open');
			$('main div.add-new-item').removeClass('open').css({opacity: 1.0}).animate({opacity: 0.0}, 100);
			AutoForm.resetForm('insertItemForm');
		} else {
			//Is closed
			$('#insertItemForm')[0].reset();
			$('main tr#item-insert').toggleClass('form-open');
			$('main div.single-page-container').toggleClass('form-open');
			$('main div.add-new-item').addClass('open').css({opacity: 0.0}).animate({opacity: 1.0}, 100);
			$('#insertItemForm input.first').focus();
		}
	}
);

Template.registerHelper("debugOps",
	debugOps = function() {
		if ( $('.debug').hasClass('debug-open') ) {
			//Is open
			$('body div.debug').toggleClass('debug-open');
		} else {
			//Is closed
			$('body div.debug').toggleClass('debug-open');
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

Template.registerHelper('headerVisible', function() {
	if (Session.get("headerVisibility") == "visible"){
		return true;
	} else {
		return false;
	}
});

headerVisibility = function() {
	if (Session.get("headerVisibility") == "hidden") {
		Session.set("headerVisibility", "visible");
		$('header').slideDown({
			duration: 100,
			easing: "easeInOutCubic"
		});
	} else {
		Session.set("headerVisibility", "hidden");
		$('header').slideUp({
			duration: 100,
			easing: "easeInOutCubic"
		});
	}
}

resizeAce = function() {
    var h = window.innerHeight;
        $('#archy').css('height', (h - 290).toString() + 'px');
};