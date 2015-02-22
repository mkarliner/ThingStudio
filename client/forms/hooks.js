
compileTemplate = function(name, html_text) {
  try {
    var compiled = SpacebarsCompiler.compile(html_text, { isTemplate:true });
      var renderer = eval(compiled);
      // console.log('rendered:',renderer);
	  Template.__checkName(name);
      Template[name] = new Template("Template." + name,renderer);
      //Template.__define__(name, renderer);
	Template['faceplate'].helpers({
		ddd: function() {
			console.log("Mike");
				return "mike";
		},
		messages: function(feed){
			return Messages.find({topic: feed});
		}
	});
  } catch (err){
    console.log('Error compiling template:' + html_text);
    console.log(err.message);
  }
};



AutoForm.hooks({
	updateScreenForm: {
		before: {
			// update: function(docId, mod, template) {
		// 		console.log("Before update")
		// 		//doc.status = "Inactive";
		// 		return mod;
		// 	}
		},
		after: {
			update: function(err, res, template) {
				delete Template.faceplate;			//Remove the existing template instance.
				//console.log("Updated Screen", template.data.doc.html);
				screen = Session.get("currentScreen");
				compileTemplate('faceplate', template.data.doc.html);

				Session.set("currentScreen", "rubbish")
				Session.set("currentScreen", 'faceplate')
			}
		}
	},



});