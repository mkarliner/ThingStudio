Template.EditScreenHeader.helpers({
	log: function() {
		console.log(this);
	}
});

Template.EditScreenBody.events({
	'click #togglePreview': function(ev){
		$('#renderScreen').toggle();
		$('#editScreen').toggleClass('fullWidth');
	}
});

Template.EditScreenBody.helpers({
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
	},
	compilationErrors: function(){
		return Session.get("compilationErrors")
	},
	runtimeErrors: function(){
		return Session.get("runtimeErrors");
	},
	accessStatus: function(){
		if(this.owner != Meteor.userId()) {
			return "This Screen is read - only, you can make edits, but they will have no effect. Go to 'Screens' and click 'Add Screen' to edit your own."
		}
	}
});

Meteor.startup(function(){
	AutoForm.addInputType('acecss', {
		template: 'afAceCss',
		valueOut: function(obj) {
			//console.log("OUT: ", AceEditor.instance("archycss").getValue())
			return AceEditor.instance("archycss").getValue();
		}
	});

	AutoForm.addInputType('acejs', {
		template: 'afAceJs',
		valueOut: function(obj) {
			// console.log("OUT: ", AceEditor.instance("archyjs").getValue())
			return AceEditor.instance("archyjs").getValue();
		}
	});

	AutoForm.addInputType('ace', {
		template: 'afAce',
		valueOut: function(obj) {
			// console.log("OUT: ", AceEditor.instance("archy").getValue())
			return AceEditor.instance("archy").getValue();
		}
	});
})

Template.afAce.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj, this);
	},
	loadValue: function(editor){
		// console.log("Setting value ", this.value)
		// ace = AceEditor.instance("archy",{
		//     theme:"dawn",
		//     mode:"html"
		// });
		//  ace.setValue(this.value);

	}
});

Template.afAceCss.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj);
	},
	loadValue: function(editor){
		// console.log("Setting value ", this.value)
		// ace = AceEditor.instance("archy",{
		//     theme:"dawn",
		//     mode:"html"
		// });
		//  ace.setValue(this.value);

	}
});

Template.afAceJs.helpers({
	debug: function(obj){
		// console.log("DEBUG:", obj, this);
	},
	loadValue: function(editor){
	}
});

Template.afAceJs.rendered = function() {
	var editor;
	// console.log("RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archyjs", {
			theme: "twilight",
			mode: "javascript"
		});

		if(editor.loaded===true){
			e.stop();
			cs = Session.get("currentScreenPage");
			editor.$blockScrolling = Infinity;
			editor.setValue(Screens.findOne({_id: cs}).js, -1);
		}
	}); 
}

Template.afAceCss.rendered = function() {
	var editor;
	// console.log("RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archycss", {
			theme: "twilight",
			mode: "css"
		});

		if(editor.loaded===true){
			e.stop();
			editor.$blockScrolling = Infinity; 
		}
	}); 
}

Template.afAce.rendered = function() {
	var editor;
	// console.log("RENDERED", this.findAll());
	Tracker.autorun(function (e) {

		editor = AceEditor.instance("archy", {
			theme: "cobalt",
			mode: "handlebars",
			height: 500
		});
		console.log(editor)
		if(editor.loaded===true){
			e.stop();
			cs = Session.get("currentScreenPage");
			editor.$blockScrolling = Infinity;
			editor.setValue(Screens.findOne({_id: cs}).html, -1);
		}
	}); 
}