var compileDocPage = function(name, html_text) {
  try {
    var compiled = SpacebarsCompiler.compile(html_text, { isTemplate:true });
      var renderer = eval(compiled);
      // console.log('doc rendered:',renderer);
	  Template[name] = new Template("Template." + name, renderer);
  } catch (err){
    console.log('Error compiling template:' + html_text);
    console.log(err.message);
  }
};


Template.DocsHeader.helpers({
	log: function() {
		console.log('doc page: ', this)
	},
	nextpage: function(){
		return 0;
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$gt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	},
	prevpage: function(){
			return 0;
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$lt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	}
});

Template.DocsBody.helpers({
	publishedDate: function(date) {
		return moment(date).format('MMMM D, YYYY');
	},
    currentDoc: function() {
			doc = this.body
            delete Template[this.title];
            compileDocPage(this.title, this.body);
            return this.title;
    },

});

Template.OldDocsHeader.helpers({
	log: function() {
		console.log('doc page: ', this)
	},
	nextpage: function(){
		return 0;
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$gt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	},
	prevpage: function(){
			return 0;
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$lt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	}
});

Template.OldDocsBody.helpers({
	publishedDate: function(date) {
		return moment(date).format('MMMM D, YYYY');
	},


});

