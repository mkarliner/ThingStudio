Template.templatelist.helpers({
	template_list: function() {
		
		sns =  Screens.find({isWidget: false});
		// console.log("SNS: ", sns)
		return sns;
	},

});

Template.registerHelper("templateUrl", function(){
		// console.log("URL", this)
		return "/viewer/screen/" + this._id;
});

Template.registerHelper("templateUrlForName", function(title){
		// console.log("URL", this)
	if(typeof title != "string" ) {
		Session.set("runtimeErrors", "Name of screen must be a string");
		return "Name of screen must be a string";
	} else {
		scr = Screens.findOne({title: title});
		if(!scr) {
			return "No such screen: " + title;
		} else {
			return "/viewer/screen/" + scr._id;
		}
		
	}
});

Template.registerHelper("templateForName", function(title){
		// console.log("URL", this)
	if(typeof title != "string" ) {
		Session.set("runtimeErrors", "Name of screen must be a string");
		return "Name of screen must be a string";
	} else {
		scr = Screens.findOne({title: title});
		if(!scr) {
			return "No such screen: " + title;
		} else {
			return  scr;
		}
		
	}
});