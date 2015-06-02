Template.DocsHeader.helpers({
	log: function() {
		console.log('doc page: ', this)
	},
	nextpage: function(){
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$gt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	},
	prevpage: function(){
		console.log("PN ", this.pagenumber)
		hp =  HelpPages.findOne({pagenumber: {$lt: this.pagenumber}});
		console.log("HP: ", hp);
		return hp.urlstring;
	}
});

Template.DocsBody.helpers({
	publishedDate: function(date) {
		return moment(date).format('MMMM D, YYYY');
	}
})