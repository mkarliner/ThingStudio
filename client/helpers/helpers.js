Template.registerHelper(
	"gravatar", function() {
		if( Meteor.user() ) {
			return Gravatar.imageUrl( Meteor.user().emails[0].address, {
				size: 84,
				default: "http://www.thingstud.io/images/ts-profile-new.png"
			});
		}
	}
);

Template.registerHelper(
	"currentUsername", function() {
		if( Meteor.user() ) {
			return Meteor.user().username
		}
	}
);

Template.registerHelper(
	"appDocumentation", function () {
		if( Meteor.user() ) {
			return Apps.findOne( { _id: this.appId } ).documentation
		}
	}
)

Template.registerHelper(
	"templateTitle", function () {
		return this.title
	}
)

Template.registerHelper("templatePath", function() {
		// console.log("URL", this)
		return "/app/" + this.appId + "/screen/" + this._id
});

Template.registerHelper("templatePathByName", function( title ) {
		// console.log("URL", this)
	if( typeof title != "string" ) {
		Session.set( "runtimeErrors", "Name of template must be a string" )
		return "Name of template must be a string"
	} else {
		scr = Screens.findOne( { title: title } )
		if( !scr ) {
			return "No such template: " + title
		} else {
			return "/app/" + scr.appId + "/screen/" + scr._id
		}
	}
});

Template.registerHelper("templateByName", function( title ){
		// console.log("URL", this)
	if( typeof title != "string" ) {
		Session.set("runtimeErrors", "Name of template must be a string")
		return "Name of template must be a string"
	} else {
		scr = Screens.findOne( { title: title } )
		if( !scr ) {
			return "No such template: " + title
		} else {
			return  scr
		}
	}
});

Template.registerHelper(
	"meteor_status", function() {
		stat = Meteor.status()
		// console.log("MS: ", stat)
		switch( stat.status ) {
		case "connected":
			return "status-active"
			break
		case "waiting":
			return "status-retry"
			break
		case "offline":
			return "status-offline"
			break
		default:
			return "status-unknown"
			break
		}
	})

Template.registerHelper(
	"curr_app_name", function() {
		title = Session.get( "currentApp" ).title
		return title ? title : "No current app - please select one"
	}
)

Template.registerHelper("indexedArray",
	function( arr ) {
		length = arr.length
  	return _.map( arr, function( value, index ){
			return { value: value, index: index, length: length }
  	})
	}
)

Template.registerHelper("accessStatus",
	function () {
		if(this.owner != Meteor.userId()) {
			sAlert.info('FYI: This app is read-only. It is for demonstration purposes. Once you feel comfortable, go to Apps and make one of your own!');
		}
	}
)

// Template.registerHelper("menuOps",
// 	menuOps = function() {
// 		if ( $('main div.add-new-item').hasClass('open') ) {
// 			//Is open
// 			$('main tr#item-insert').toggleClass('form-open');
// 			$('main div.single-page-container').toggleClass('form-open');
// 			$('main div.add-new-item').removeClass('open').css({opacity: 1.0}).animate({opacity: 0.0}, 100);
// 			AutoForm.resetForm('insertItemForm');
// 		} else {
// 			//Is closed
// 			$('#insertItemForm')[0].reset();
// 			$('main tr#item-insert').toggleClass('form-open');
// 			$('main div.single-page-container').toggleClass('form-open');
// 			$('main div.add-new-item').addClass('open').css({opacity: 0.0}).animate({opacity: 1.0}, 100);
// 			$('#insertItemForm input.first').focus();
// 		}
// 	}
// );

Template.registerHelper("deviceOrientation", function(){
	//console.log("DEVO ", Session.get("deviceOrientation"))
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
    var h = window.innerHeight
    $('#archy').css('height', (h - 290).toString() + 'px')
};
