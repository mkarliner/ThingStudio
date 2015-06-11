Template.updateScreenForm.onRendered(function() {
	$('ul.tabs').tabs();
});

Template.updateScreenForm.helpers({
	currentScreen: function() {
		scr =  Session.get("currentScreenPage");
		scn = Screens.findOne(scr);
		console.log("HTML: ", scn);
		if(scn) {
			console.log("HTML: ", scn.html);
			delete Template[scn.title];
			compileTemplate(scn.title, scn.html, scn.js);
			return scn.title;
		} else {
			return "NoScreen";
		}
	}
});