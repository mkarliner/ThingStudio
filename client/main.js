

Meteor.startup(function(){
	
	console.log("Subscribing");
	Meteor.subscribe("connexions", {
		onReady: function(){
			console.log("Connexions ready");
			conn = Connexions.findOne({autoConnect: true});
			console.log("Autoconnect: ", conn);
			connect(conn);
		},
		onError: function(error){
			console.log("Connexions error", error);
		}
	});
	
	Meteor.subscribe("screens", {
		onReady: function(){
			console.log("Screens ready");
			scr = Session.get("currentScreen");
			scn = Screens.findOne({title: "TestScreen"});
			console.log("SCREEN:", scn);
			if (scn) {
				// console.log("HTML: ", scn.html);
				delete Template.faceplate;
				compileTemplate('faceplate', scn.html);
				return scr;
			} else {
				return null;
			}
		},
		onError: function(error){
			console.log("Screens error", error);
		}
	});
	
	Meteor.subscribe("feeds", {
		onReady: function(){
			console.log("Feeds ready");
		},
		onError: function(error){
			console.log("Feeds error", error);
		}
	});
	
	Meteor.subscribe("themes", {
		onReady: function(){
			console.log("Themes ready");
		},
		onError: function(error){
			console.log("Themes error", error);
		}
	});
	
	
	
	
})
