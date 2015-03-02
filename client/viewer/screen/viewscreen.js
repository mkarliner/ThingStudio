Template.ViewScreen.helpers({
	myScreen: function(){
		scr = Session.get("currentScreenPage");
		
		return scr;
	},
    currentScreen: function() {
            scr =  Session.get("currentScreenPage");
            scn = Screens.findOne(scr);
            if(scn) {
                    // console.log("HTML: ", scn.html);
                    delete Template[scn.title];
                    compileTemplate(scn.title, scn.html);

                    return scn.title;
            } else {
                    return "UnknownScreen";
            }
    },
	
}); 