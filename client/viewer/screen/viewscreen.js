// Template.appScreen.registerElement('app-screen');

Template.ViewScreen.events({
	'click a': function (e, tmpl) {
	}
})

Template.ViewScreen.onRendered(function(){
	// console.log("VS: ", this)
	if ( this.data ) {
		Meteor.call("templateView", this.data._id);
	}
})

Template.ViewScreen.helpers({
	myScreen: function(){
		scr = Session.get("currentScreenPage");
		return scr;
	},
	appCSS: function () {
		return getCurrentApp().css;
	},
  currentScreen: function() {
          scr =  Session.get("currentScreenPage");
          scn = Screens.findOne(scr);
          if(scn) {
                  // console.log("HTML: ", scn.html);
                  delete Template[scn.title];
                  compileTemplate(scn.title, scn.html, scn.js);

                  return scn.title;
          } else {
                  return "UnknownScreen";
          }
  }
});
