// var compileTemplate = function(name, html_text) {
//   try {
//     var compiled = SpacebarsCompiler.compile(html_text, { isTemplate:true });
//       var renderer = eval(compiled);
//       console.log('redered:',renderer);
//           Template.__checkName(name);
//       Template[name] = new Template("Template." + name,renderer);
//       //Template.__define__(name, renderer);
//         Template['faceplate'].helpers({
//                 ddd: function() {
//                         console.log("Mike");
//                                 return "mike";
//                         }
//         });
//   } catch (err){
//     console.log('Error compiling template:' + html_text);
//     console.log(err.message);
//   }
// };

AutoForm.addInputType('acecss', {
	template: 'afAceCss',
	valueOut: function(obj) {
		console.log("OUT: ", AceEditor.instance("archy").getValue())
		return AceEditor.instance("archy").getValue();
	}
});


AutoForm.addInputType('ace', {
	template: 'afAce',
	valueOut: function(obj) {
		console.log("OUT: ", AceEditor.instance("archy").getValue())
		return AceEditor.instance("archy").getValue();
	}
});

Template.afAce.helpers({
	debug: function(obj){
		console.log("DEBUG:", obj);
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

Template.afAceCss.rendered = function() {
    var editor;
	//console.log("RENDERED", this.findAll());
   Tracker.autorun(function (e) {
   editor = AceEditor.instance("archy", {
	   theme: "twilight",
	   mode: "css"
   });
   
   if(editor.loaded===true){
     e.stop();
   }
 }); 
}

Template.afAce.rendered = function() {
    var editor;
	//console.log("RENDERED", this.findAll());
   Tracker.autorun(function (e) {
   editor = AceEditor.instance("archy", {
	   theme: "twilight",
	   mode: "handlebars"
   });
   
   if(editor.loaded===true){
     e.stop();
   }
 }); 
}






Template.Screen.helpers({
	currentScreen: function(){
		console.log("hello", this)
	},
    myScreen: function() {
            scr =  Session.get("currentScreen");
            scn = Screens.findOne({title: "TestScreen"});
            // console.log("SCREEN:", scn);
            if(scn) {
                    // console.log("HTML: ", scn.html);
                    delete Template.faceplate;
                    compileTemplate('faceplate', scn.html);

                    return "faceplate";
            } else {
                    return "faceplate";
            }
    },
	compilationErrors: function(){
		return Session.get("compilationErrors")
	}
});