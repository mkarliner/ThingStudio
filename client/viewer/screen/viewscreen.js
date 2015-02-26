Template.ViewScreen.helpers({
	myScreen: function(){
		scr = Session.get("currentScreenPage");
		
		return scr;
	},
    currentScreen: function() {
            scr =  Session.get("currentScreenPage");
            scn = Screens.findOne(scr);
			console.log("SCREENL ", scn.title)
            // console.log("SCREEN:", scn);
            if(scn) {
                    // console.log("HTML: ", scn.html);
                    delete Template[scn.title];
                    compileTemplate(scn.title, scn.html);

                    return scn.title;
            } else {
                    return scn.title;
            }
    },
	
}); 